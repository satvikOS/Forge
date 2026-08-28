// ui/test/ui_test_util.hpp — the minimal check harness for the headless UI gates.
//
// SR-3: every check asserts a VALUE against a REFERENCE. There is no "did not
// throw" check here on purpose, and no global mutable state: each test owns a
// local `Harness H` and the macros name it, so two tests in one binary can never
// contaminate each other's counts.
#ifndef FORGE_UI_TEST_UTIL_HPP
#define FORGE_UI_TEST_UTIL_HPP

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

namespace forge::uitest {

struct Harness {
  const char* name;
  std::size_t checks = 0;
  std::size_t failures = 0;

  explicit Harness(const char* n) : name(n) {}

  int finish() {
    std::printf("[%s] %zu checks, %zu failures — %s\n", name, checks, failures,
                failures == 0 ? "PASS" : "FAIL");
    return failures == 0 ? 0 : 1;
  }
};

inline void checkTrue(Harness& h, bool value, const char* expr, const char* file, int line) {
  ++h.checks;
  if (value) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  expected true: %s\n", file, line, expr);
}

inline void checkEqInt(Harness& h, long long got, long long want, const char* expr,
                       const char* file, int line) {
  ++h.checks;
  if (got == want) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got %lld, want %lld\n", file, line, expr, got, want);
}

inline void checkLeInt(Harness& h, long long got, long long bound, const char* expr,
                       const char* file, int line) {
  ++h.checks;
  if (got <= bound) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got %lld, want <= %lld\n", file, line, expr, got, bound);
}

inline void checkEqStr(Harness& h, const std::string& got, const std::string& want,
                       const char* expr, const char* file, int line) {
  ++h.checks;
  if (got == want) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got \"%s\", want \"%s\"\n", file, line, expr, got.c_str(),
              want.c_str());
}

inline void checkNear(Harness& h, double got, double want, double tol, const char* expr,
                      const char* file, int line) {
  ++h.checks;
  if (std::fabs(got - want) <= tol) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got %.9g, want %.9g (tol %.3g)\n", file, line, expr, got,
              want, tol);
}

// Bounds-safe element read. A CHECK on a container's size must never be
// followed by an UNGUARDED index: when the size check fails, indexing is
// undefined behaviour and the gate dies with a signal instead of printing which
// contract broke. This turns that crash back into a readable failure.
inline std::string at(const std::vector<std::string>& v, std::size_t i) {
  return i < v.size() ? v[i] : std::string("<out-of-range>");
}

}  // namespace forge::uitest

#define CHECK(expr) ::forge::uitest::checkTrue(H, (expr), #expr, __FILE__, __LINE__)
#define CHECK_EQ_INT(got, want) \
  ::forge::uitest::checkEqInt(H, static_cast<long long>(got), static_cast<long long>(want), \
                              #got " == " #want, __FILE__, __LINE__)
#define CHECK_LE_INT(got, bound) \
  ::forge::uitest::checkLeInt(H, static_cast<long long>(got), static_cast<long long>(bound), \
                              #got " <= " #bound, __FILE__, __LINE__)
#define CHECK_EQ_STR(got, want) \
  ::forge::uitest::checkEqStr(H, (got), (want), #got " == " #want, __FILE__, __LINE__)
#define CHECK_NEAR(got, want, tol) \
  ::forge::uitest::checkNear(H, (got), (want), (tol), #got " ~= " #want, __FILE__, __LINE__)

#endif  // FORGE_UI_TEST_UTIL_HPP
