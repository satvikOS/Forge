// ─────────────────────────────────────────────────────────────────────────────
// numeral_word_dump.cpp — how the redactor's numeral reader classifies words.
//
// Reads one word per line on stdin and prints, tab-separated:
//     <word>  <numeral 0|1>  <ambiguous 0|1>  <joiner 0|1>  <decimal 0|1>
// retrieval/tools/gen_numeral_lexicon.py --verify-cxx runs every word of the
// dictionary through this and through its own twin of the recogniser, and
// fails on any word the two disagree about: the tables were inferred under the
// generator's rules, so the C++ must be reading by the same rules.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <iostream>
#include <string>

#include "forge/retrieval/Redactor.hpp"

int main() {
  std::string word;
  while (std::getline(std::cin, word)) {
    if (!word.empty() && word.back() == '\r') word.pop_back();
    const forge::retrieval::detail::NumeralWordInfo info = forge::retrieval::detail::classifyNumeralWord(word);
    std::printf("%s\t%d\t%d\t%d\t%d\n", word.c_str(), info.numeral ? 1 : 0, info.ambiguous ? 1 : 0,
                info.joiner ? 1 : 0, info.decimal ? 1 : 0);
  }
  return 0;
}
