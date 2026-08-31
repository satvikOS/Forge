#pragma once

// Minimal value-asserting test harness for the simulation gates.
//
// SR-3: every check compares a MEASURED value against a stated REFERENCE and
// prints both. "Did not throw" is not a test, so there is deliberately no
// no-argument PASS macro here -- every entry point takes a value and a bound.
// `TestRun::exitCode()` returns non-zero whenever any check failed, so a gate
// that fails cannot exit 0.

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>

namespace forge {
namespace simtest {

// %.10g, not std::to_string. std::to_string(double) is fixed at six decimals, so any value below
// 1e-6 prints as "0.000000" -- which made the four-bar and slider-crank gates print
// "maxPositionDelta=0.000000 must be > 0" next to a [PASS]. The predicate was right (a strict
// `> 0.0` on a delta of ~1e-8); the EVIDENCE contradicted the claim it was evidence for, so a
// reader auditing the log could not confirm the check and would learn to discount the mismatch.
inline std::string fmtG(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.10g", v);
    return std::string(buf);
}

class TestRun {
public:
    explicit TestRun(const char* name) : name_(name) {
        std::printf("=== %s ===\n", name);
    }

    // value-vs-reference: |value - reference| <= tol
    void near(const char* what, double value, double reference, double tol) {
        const double err = std::abs(value - reference);
        record(err <= tol, what,
               "measured=" + fmt(value) + " reference=" + fmt(reference) +
               " |err|=" + fmt(err) + " tol=" + fmt(tol));
    }

    // value-vs-bound: value <= bound
    void atMost(const char* what, double value, double bound) {
        record(value <= bound, what, "measured=" + fmt(value) + " bound<=" + fmt(bound));
    }

    // value-vs-bound: value >= bound
    void atLeast(const char* what, double value, double bound) {
        record(value >= bound, what, "measured=" + fmt(value) + " bound>=" + fmt(bound));
    }

    void equalU64(const char* what, std::uint64_t value, std::uint64_t reference) {
        record(value == reference, what,
               "measured=" + std::to_string(value) + " reference=" + std::to_string(reference));
    }

    void differU64(const char* what, std::uint64_t a, std::uint64_t b) {
        record(a != b, what,
               "a=" + std::to_string(a) + " b=" + std::to_string(b) + " (must differ)");
    }

    void equalStr(const char* what, const std::string& value, const std::string& reference) {
        record(value == reference, what,
               "measured=\"" + value + "\" reference=\"" + reference + "\"");
    }

    // A predicate whose evidence string carries the measured values.
    void predicate(const char* what, bool ok, const std::string& evidence) {
        record(ok, what, evidence);
    }

    void note(const std::string& line) { std::printf("     %s\n", line.c_str()); }

    int exitCode() const {
        std::printf("--- %s: %d passed, %d FAILED ---\n", name_, passed_, failed_);
        if (failed_ == 0) std::printf("RESULT %s: ALL %d CHECKS PASSED\n", name_, passed_);
        else              std::printf("RESULT %s: %d CHECK(S) FAILED\n", name_, failed_);
        return failed_ == 0 ? 0 : 1;
    }

private:
    static std::string fmt(double v) { return fmtG(v); }

    void record(bool ok, const char* what, const std::string& evidence) {
        if (ok) { ++passed_; std::printf("  [PASS] %-58s %s\n", what, evidence.c_str()); }
        else    { ++failed_; std::printf("  [FAIL] %-58s %s\n", what, evidence.c_str()); }
    }

    const char* name_;
    int passed_ = 0;
    int failed_ = 0;
};

}  // namespace simtest
}  // namespace forge
