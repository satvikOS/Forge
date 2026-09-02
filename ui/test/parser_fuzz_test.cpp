// ui/test/parser_fuzz_test.cpp — MALFORMED INPUT MUST DIAGNOSE, NEVER CRASH.
//
// Three parsers in forge::ui read text the application did not write: the dock
// layout, the keymap and the whole shell state. All three are reached from ONE
// place at startup —
//
//     main.cpp: read ~/.forge/shell_state.txt
//       -> ForgeShell::loadState()
//         -> DockLayout::parse()  and  Keymap::parse()
//
// — which means anything they cannot survive is a crash BEFORE the window opens,
// on a file the user has never heard of and cannot be expected to delete.
//
// ── the defect this gate was written for, MEASURED before it was fixed ──────
// DockLayout::readNode() recursed once per `S` token with NO depth limit. A
// 2 088 936-byte state file nesting 100 000 splits killed the parser with
// SIGSEGV (exit 139); a sweep put the threshold between 10 000 and 20 000 on the
// main thread's 8 MB stack, and roughly thirty times lower on a secondary
// thread. It is now bounded at depth 64 and the same input is REFUSED, which is
// what this parser already did for every other kind of corruption.
//
// ── what a fuzz gate has to do to be worth its runtime ─────────────────────
//   1. BE DETERMINISTIC. A fixed seed and a xorshift generator, so a red here is
//      a red on every machine and can be reproduced by seed and index. A fuzzer
//      whose failures cannot be reproduced is a flake generator.
//   2. BE NON-VACUOUS. The mutants must include some the parser ACCEPTS and some
//      it REFUSES, and the gate asserts both counts are non-zero. A corpus that
//      is 100 % rejected proves only that the first byte check works.
//   3. ASSERT A PROPERTY, not just survival. Every input the parser ACCEPTS must
//      round-trip: serialize -> parse -> serialize byte-identically, and the
//      accepted layout must satisfy valid(). "It did not crash" would pass on a
//      parser that silently returned an empty layout for everything.
//   4. KEEP THE KNOWN CRASHERS AS NAMED REGRESSIONS, not just as random draws —
//      a random walk is not guaranteed to rediscover a 100 000-deep nest.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/DockLayout.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "ui_test_util.hpp"

using forge::ui::DockLayout;
using forge::ui::ForgeShell;
using forge::ui::Keymap;

namespace {

// xorshift64*: deterministic, seeded once, no library-version dependence. Two
// runs on two machines draw the same bytes, which is the whole point.
struct Rng {
  std::uint64_t s;
  explicit Rng(std::uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
  std::uint64_t next() {
    s ^= s >> 12;
    s ^= s << 25;
    s ^= s >> 27;
    return s * 2685821657736338717ull;
  }
  std::size_t below(std::size_t n) { return n == 0 ? 0 : static_cast<std::size_t>(next() % n); }
};

// A layout nested `depth` splits deep. This is the shape that SIGSEGV'd.
std::string nestedLayout(std::size_t depth) {
  std::string t = "forge-dock 1 1\nw 1 0 0 0 1600 900 1";
  for (std::size_t i = 0; i < depth; ++i) t += " S h 0.5 T 0 1 p" + std::to_string(i);
  t += " T 0 1 leaf";
  return t;
}

// Ten mutators. Each takes a valid document and damages it in one specific way,
// so a red names a KIND of corruption rather than "byte 4213 differed".
std::string mutate(const std::string& seed, Rng& rng) {
  std::string s = seed;
  if (s.empty()) return s;
  switch (rng.below(10)) {
    case 0: {  // flip a byte
      s[rng.below(s.size())] = static_cast<char>(rng.next() & 0xFF);
      return s;
    }
    case 1: {  // truncate — the "file was cut short" case
      return s.substr(0, rng.below(s.size()));
    }
    case 2: {  // insert a NUL, which std::string carries and istringstream does not
      s.insert(rng.below(s.size()), 1, '\0');
      return s;
    }
    case 3: {  // duplicate a line: the stream desynchronises
      const std::size_t nl = s.find('\n', rng.below(s.size()));
      if (nl == std::string::npos) return s;
      const std::size_t prev = s.rfind('\n', nl > 0 ? nl - 1 : 0);
      const std::size_t begin = prev == std::string::npos ? 0 : prev + 1;
      return s.substr(0, nl + 1) + s.substr(begin, nl + 1 - begin) + s.substr(nl + 1);
    }
    case 4: {  // a count field that claims the world
      return s + " 18446744073709551615";
    }
    case 5: {  // an absurdly long token
      return s + " " + std::string(1u << 16, 'A');
    }
    case 6: {  // numbers strtod has opinions about
      static const char* kNums[] = {"nan", "inf", "-inf", "1e400", "-0", "0x10", ".", "1e-400"};
      return s + " " + kNums[rng.below(8)];
    }
    case 7: {  // splice two seeds' worth of structure
      return s + "\n" + s;
    }
    case 8: {  // delete a random span
      const std::size_t a = rng.below(s.size());
      const std::size_t b = a + rng.below(s.size() - a + 1);
      return s.substr(0, a) + s.substr(b);
    }
    default: {  // deepen the nesting a little — the measured crasher, in miniature
      const std::size_t nl = s.find('\n');
      if (nl == std::string::npos) return s;
      std::string ins;
      for (std::size_t i = 0; i < 1 + rng.below(200); ++i) ins += " S h 0.5 T 0 1 x";
      return s.substr(0, nl + 1) + "w 9 0 0 0 100 100 0" + ins + " T 0 1 y\n" + s.substr(nl + 1);
    }
  }
}

}  // namespace

int main() {
  forge::uitest::Harness H("parser_fuzz");

  // ── the seed corpus: real documents this application actually writes ──────
  std::vector<std::string> layoutSeeds;
  for (forge::ui::WorkspaceProfile p : forge::ui::allWorkspaceProfiles()) {
    layoutSeeds.push_back(forge::ui::defaultLayout(p).serialize());
  }
  CHECK(layoutSeeds.size() >= 4);

  ForgeShell seedShell;
  const std::string stateSeed = seedShell.saveState();
  CHECK(!stateSeed.empty());
  const std::string keymapSeed = seedShell.keymap().serialize();
  CHECK(!keymapSeed.empty());

  // Sanity: every seed is accepted and round-trips. A fuzzer whose seeds are
  // already rejected is fuzzing the first byte check.
  for (const std::string& seed : layoutSeeds) {
    DockLayout back;
    CHECK(DockLayout::parse(seed, back));
    CHECK_EQ_STR(back.serialize(), seed);
  }
  {
    ForgeShell s2;
    CHECK(s2.loadState(stateSeed));
    Keymap km;
    CHECK(Keymap::parse(keymapSeed, km));
  }

  // ── 1. THE NAMED REGRESSIONS ─────────────────────────────────────────────
  // The measured crasher, and its heap-side twin. These are asserted by name
  // because a random walk is not guaranteed to rediscover a 100 000-deep nest,
  // and a defect that cost a SIGSEGV should never depend on luck to stay fixed.
  {
    // 100 000 splits: 2 MB of input that used to exit 139.
    DockLayout out;
    CHECK(!DockLayout::parse(nestedLayout(100000), out));
    // Just past the bound is refused...
    CHECK(!DockLayout::parse(nestedLayout(65), out));
    // ...and just inside it is still ACCEPTED, which is what keeps the bound a
    // bound and not a capability cut: the parser did not get narrower, it got
    // total.
    CHECK(DockLayout::parse(nestedLayout(63), out));
    CHECK_EQ_INT(static_cast<long long>(out.panelCount()), 64);
    CHECK(out.valid());
    // A header that declares a billion windows must not allocate its way there.
    CHECK(!DockLayout::parse("forge-dock 1 1000000000\n", out));
    // A tab group that declares a billion panels, likewise.
    CHECK(!DockLayout::parse("forge-dock 1 1\nw 1 0 0 0 100 100 1 T 0 1000000000\n", out));
    // The same shapes, reached through the REAL startup path.
    ForgeShell sh;
    CHECK(!sh.loadState("forge-shell 1\nworkspace Part\ninput ForgeNative\nlayout Part\n" +
                        nestedLayout(100000) + "\n.\n"));
  }

  // ── 2. THE FUZZ RUN ──────────────────────────────────────────────────────
  Rng rng(0xF0F9E5C0DEull);
  std::size_t accepted = 0;
  std::size_t refused = 0;
  std::size_t roundTripFailures = 0;
  std::size_t invalidAccepted = 0;
  constexpr std::size_t kIterations = 20000;

  for (std::size_t i = 0; i < kIterations; ++i) {
    const std::string& seed = layoutSeeds[rng.below(layoutSeeds.size())];
    std::string input = mutate(seed, rng);
    if (rng.below(4) == 0) input = mutate(input, rng);  // two damages, sometimes

    DockLayout parsed;
    bool ok = false;
    try {
      ok = DockLayout::parse(input, parsed);
    } catch (...) {
      // An exception escaping a parser is a crash with extra steps: loadState's
      // caller in main.cpp has no catch, so it would terminate the process.
      ++H.failures;
      ++H.checks;
      std::printf("  FAIL parser_fuzz: DockLayout::parse threw on iteration %zu\n", i);
      break;
    }
    if (!ok) {
      ++refused;
      continue;
    }
    ++accepted;
    // THE PROPERTY: what was accepted must be a layout the app can use and save.
    if (!parsed.valid()) ++invalidAccepted;
    const std::string re = parsed.serialize();
    DockLayout again;
    if (!DockLayout::parse(re, again) || !(again == parsed) || again.serialize() != re) {
      ++roundTripFailures;
    }
  }

  std::printf("[parser_fuzz] dock layout: %zu inputs, %zu accepted, %zu refused\n", kIterations,
              accepted, refused);
  CHECK_EQ_INT(static_cast<long long>(roundTripFailures), 0);
  CHECK_EQ_INT(static_cast<long long>(invalidAccepted), 0);
  // NON-VACUITY, both ways. All-refused means the fuzzer never got past the
  // header; all-accepted means it never damaged anything.
  CHECK(accepted > 0);
  CHECK(refused > 0);

  // ── 3. the KEYMAP, same treatment ────────────────────────────────────────
  std::size_t kmAccepted = 0;
  std::size_t kmRefused = 0;
  std::size_t kmRoundTrip = 0;
  for (std::size_t i = 0; i < kIterations / 2; ++i) {
    const std::string input = mutate(keymapSeed, rng);
    Keymap km;
    bool ok = false;
    try {
      ok = Keymap::parse(input, km);
    } catch (...) {
      ++H.failures;
      ++H.checks;
      std::printf("  FAIL parser_fuzz: Keymap::parse threw on iteration %zu\n", i);
      break;
    }
    if (!ok) {
      ++kmRefused;
      continue;
    }
    ++kmAccepted;
    const std::string re = km.serialize();
    Keymap again;
    if (!Keymap::parse(re, again) || again.serialize() != re) ++kmRoundTrip;
  }
  std::printf("[parser_fuzz] keymap: %zu inputs, %zu accepted, %zu refused\n", kIterations / 2,
              kmAccepted, kmRefused);
  CHECK_EQ_INT(static_cast<long long>(kmRoundTrip), 0);
  CHECK(kmAccepted > 0);
  CHECK(kmRefused > 0);

  // ── 4. THE WHOLE SHELL STATE — the file main.cpp actually opens ──────────
  std::size_t stAccepted = 0;
  std::size_t stRefused = 0;
  for (std::size_t i = 0; i < kIterations / 2; ++i) {
    const std::string input = mutate(stateSeed, rng);
    ForgeShell sh;
    bool ok = false;
    try {
      ok = sh.loadState(input);
    } catch (...) {
      ++H.failures;
      ++H.checks;
      std::printf("  FAIL parser_fuzz: ForgeShell::loadState threw on iteration %zu\n", i);
      break;
    }
    if (ok) {
      ++stAccepted;
      // A shell that accepted a state file must still be a working shell: its
      // layout is valid and it can save itself again.
      if (!sh.layout().valid()) ++invalidAccepted;
      if (sh.saveState().empty()) ++roundTripFailures;
    } else {
      ++stRefused;
      // ★ REFUSAL MUST NOT COST STATE. A rejected file leaves the shell on its
      // defaults, not half-loaded — that is the difference between "your layout
      // did not load" and "your layout is gone".
      if (!sh.layout().valid()) ++invalidAccepted;
    }
  }
  std::printf("[parser_fuzz] shell state: %zu inputs, %zu accepted, %zu refused\n",
              kIterations / 2, stAccepted, stRefused);
  CHECK_EQ_INT(static_cast<long long>(invalidAccepted), 0);
  CHECK_EQ_INT(static_cast<long long>(roundTripFailures), 0);
  CHECK(stAccepted > 0);
  CHECK(stRefused > 0);

  return H.finish();
}
