// ─────────────────────────────────────────────────────────────────────────────
// unicode_fold_dump.cpp — print every code point the redactor's normaliser
// MODELS, so unicode_fold_ucd_check.py can judge each entry against the Unicode
// Character Database rather than against the table's own comments.
//
// One line per modelled scalar value, tab-separated:
//     <code point hex>  <folded ASCII as hex bytes>  <script>  <Nd zero hex or 0>
// A code point that is NOT printed is refused by foldForMatch(). Surrogates are
// not scalar values and are skipped (UTF-8 cannot carry them; decodeUtf8 refuses).
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <string>

#include "forge/retrieval/Redactor.hpp"

using forge::retrieval::detail::FoldScript;

namespace {
const char* scriptName(FoldScript s) {
  switch (s) {
    case FoldScript::Common: return "Common";
    case FoldScript::Latin: return "Latin";
    case FoldScript::Cyrillic: return "Cyrillic";
    case FoldScript::Greek: return "Greek";
    case FoldScript::Armenian: return "Armenian";
  }
  return "Unknown";
}
}  // namespace

int main() {
  std::string ascii;
  unsigned long modelled = 0;
  for (char32_t cp = 0; cp <= 0x10FFFF; ++cp) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue;
    FoldScript script = FoldScript::Common;
    char32_t zero = 0;
    if (!forge::retrieval::detail::foldCodePoint(cp, ascii, script, zero)) continue;
    std::printf("%04X\t", static_cast<unsigned>(cp));
    for (const unsigned char c : ascii) std::printf("%02X", c);
    std::printf("\t%s\t%X\n", scriptName(script), static_cast<unsigned>(zero));
    ++modelled;
  }
  std::fprintf(stderr, "modelled %lu code points\n", modelled);
  return 0;
}
