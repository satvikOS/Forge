// forge-kernel/test/ft/op_record_kernel_gate.cpp
//
// T-132 -- THE OP RECORD, AGAINST THE REAL KERNEL. op_record_gate.cpp proves the
// record's grammar, round trip and refusals with no kernel linked at all; this is
// the half that needs one: an accepted record tree BUILDS, its pre/post/inv
// conditions are EVALUATED on the geometry the kernel actually produced, and a
// false one fails the compile while the part is still built and measured.
//
// Linked against libforge_kernel_core (build_op_record_kernel_gate.sh), the same
// library forge_verify and the desktop app use. Checks, each with its arm that
// must go the other way:
//   K1  records do not touch geometry: the recorded program builds the SAME solid
//       as the record-free one -- volume and face count to the bit.
//   K2  every stated condition is evaluated and labelled with phase and op.
//   K3  an op missing a required field, an UNRESOLVED provenance and a non-IR
//       unit are refused UNBUILT by the real kernel too: handle 0, nCompiled 0,
//       the progress hook never called.
//   K4  a false post, a false pre, a broken invariant (in AND out) and an
//       unevaluable condition each fail the compile, name the op, the record
//       line and the phase -- with the solid still built and measured.
//   K5  emit() -> parse() -> compile() of the recorded tree reproduces the
//       compile of the original exactly (ok, volume bits, every verify line).
#include <cstdio>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

using namespace forge::ft;

namespace {

int gChecks = 0;
int gFails = 0;
void ok(bool cond, const std::string& what) {
    ++gChecks;
    if (cond) return;
    ++gFails;
    std::printf("  FAIL  %s\n", what.c_str());
}
bool sameBits(double a, double b) { return std::memcmp(&a, &b, sizeof a) == 0; }
bool has(const std::vector<std::string>& v, const std::string& s) {
    for (const std::string& x : v)
        if (x.rfind(s, 0) == 0) return true;
    return false;
}

int gHook = 0;
void hook(int, const char*, int, void*) { ++gHook; }

CompileResult run(const std::string& text) {
    gHook = 0;
    setCompileProgressHook(&hook, nullptr);
    CompileResult r = compileText(text, "");
    setCompileProgressHook(nullptr, nullptr);
    return r;
}

const char* const kPlain =
    "%1 = BOX(40, 30, 20)\n"
    "%2 = CYL(6, 40)\n"
    "%3 = CUT(%1, %2)\n"
    "%4 = CHAMFER(%3, 1, ALL)\n"
    "RESULT(%4)\n";

// The same program with a full record on every op. Each line is a token so a
// case can swap exactly one of them.
const std::string kReq = "@REQUIRE units deps refs pre post inv conf prov\n";
const std::string kR1 =
    "@%1 units=mm deps=none refs=\"%1:block\" pre=none post=\"faces=6\" inv=none conf=1 "
    "prov=USER src=\"user: a 40 x 30 x 20 block\"\n";
const std::string kR2 =
    "@%2 units=mm deps=none refs='%2:\"pin\" bore tool' pre=none post=\"faces=3\" inv=none "
    "conf=0.85 prov=SOURCE src='dwg A1, dim 7'\n";
const std::string kR3 =
    "@%3 units=mm deps=%1,%2 refs=\"%1:block\" refs=\"%3:bore\" pre=\"faces=6\" "
    "post=\"holes=1\" inv=\"bbox.x=40\" conf=0.9 prov=DERIVED\n";
const std::string kR4 =
    "@%4 units=mm,1 deps=%3 refs=none pre=\"holes=1\" post=\"faces>=10\" inv=\"holes=1\" "
    "inv=\"bbox.y=30\" conf=0.6 prov=PROPOSED src=\"planner: break the edges\"\n";

std::string recorded(const std::string& r1, const std::string& r3, const std::string& r4) {
    return kReq + "%1 = BOX(40, 30, 20)\n" + r1 + "%2 = CYL(6, 40)\n" + kR2 +
           "%3 = CUT(%1, %2)\n" + r3 + "%4 = CHAMFER(%3, 1, ALL)\n" + r4 + "RESULT(%4)\n";
}

std::string swap(std::string s, const std::string& from, const std::string& to) {
    const std::size_t at = s.find(from);
    if (at != std::string::npos) s.replace(at, from.size(), to);
    return s;
}

}  // namespace

int main() {
    std::printf("=== T-132 op records against the real kernel ===\n");

    // ── K1 + K2: the accepted record tree builds the record-free solid ─────────
    const CompileResult plain = run(kPlain);
    ok(plain.ok && plain.volume > 0, "K1: the record-free program builds: " + plain.error);
    ok(plain.verify.empty(), "K1: a record-free program evaluates no condition");
    const int plainHook = gHook;
    ok(plainHook == 4, "K1: the record-free build announces its 4 ops (got " +
                           std::to_string(plainHook) + ")");

    const std::string full = recorded(kR1, kR3, kR4);
    const CompileResult rec = run(full);
    std::printf("  record-free: ok=%d V=%.6f faces=%ld | recorded: ok=%d V=%.6f faces=%ld, %zu "
                "conditions\n",
                plain.ok, plain.volume, plain.faceCount, rec.ok, rec.volume, rec.faceCount,
                rec.verify.size());
    ok(rec.ok && rec.error.empty(), "K1: the fully recorded program builds: " + rec.error);
    ok(sameBits(rec.volume, plain.volume) && rec.faceCount == plain.faceCount &&
           rec.edgeCount == plain.edgeCount && rec.valid == plain.valid,
       "K1: records change no geometry (volume bits, faces, edges, validity)");
    ok(gHook == plainHook, "K1: the recorded build announces the same ops");
    // 1 post on %1, 1 on %2, pre+inv-in+post+inv-out on %3, pre+2 inv-in+post+2 inv-out on %4
    ok(rec.verify.size() == 12, "K2: all 12 stated conditions are evaluated (got " +
                                    std::to_string(rec.verify.size()) + ")");
    for (const char* want : {"PASS post %1: faces=6", "PASS post %2: faces=3",
                             "PASS pre %3: faces=6", "PASS inv-in %3: bbox.x=40",
                             "PASS post %3: holes=1", "PASS inv-out %3: bbox.x=40",
                             "PASS pre %4: holes=1", "PASS inv-in %4: holes=1",
                             "PASS inv-in %4: bbox.y=30", "PASS post %4: faces>=10",
                             "PASS inv-out %4: holes=1", "PASS inv-out %4: bbox.y=30"})
        ok(has(rec.verify, want), std::string("K2: verify carries `") + want + "`");

    // ── K3: refused unbuilt, by the real kernel ────────────────────────────────
    const struct { const char* why; std::string text; const char* prefix; int op; } refused[] = {
        {"missing conf", recorded(kR1, swap(kR3, " conf=0.9", ""), kR4),
         "RECORD_REFUSED: op %3 CUT (line 6): its record does not state conf", 3},
        {"UNRESOLVED provenance", recorded(kR1, swap(kR3, "prov=DERIVED", "prov=UNRESOLVED"), kR4),
         "RECORD_REFUSED: op %3 CUT (line 6): its provenance is UNRESOLVED", 3},
        {"inches", recorded(kR1, swap(kR3, "units=mm", "units=in"), kR4),
         "RECORD_REFUSED: op %3 CUT (line 6): unit `in` is not an IR unit", 3},
        {"an op with no record under the contract", recorded(kR1, kR3, ""),
         "RECORD_REFUSED: op %4 CHAMFER (line 8): its record does not state units deps refs "
         "pre post inv conf prov", 4},
    };
    for (const auto& c : refused) {
        const CompileResult r = run(c.text);
        ok(!r.ok && r.error.rfind(c.prefix, 0) == 0 && r.failedOpId == c.op,
           std::string("K3: ") + c.why + " is RECORD_REFUSED naming op and field: " + r.error);
        ok(r.handle == 0 && r.nCompiled == 0 && r.volume == 0.0 && r.verify.empty(),
           std::string("K3: ") + c.why + ": nothing was built");
        ok(gHook == 0, std::string("K3: ") + c.why + ": no op was ever announced (" +
                           std::to_string(gHook) + ")");
    }

    // ── K4: a false or unevaluable condition fails, after building ─────────────
    const struct {
        const char* why; std::string text; const char* errPrefix; std::vector<const char*> lines;
        std::size_t conditions;   // how many conditions the case states in all
    } failing[] = {
        {"a false post", recorded(kR1, swap(kR3, "post=\"holes=1\"", "post=\"holes=2\""), kR4),
         "op %3 CUT (record line 7): POST condition failed: holes=2", {"FAIL post %3: holes=2"}, 12},
        {"a false pre", recorded(kR1, swap(kR3, "pre=\"faces=6\"", "pre=\"faces=7\""), kR4),
         "op %3 CUT (record line 7): PRE condition failed: faces=7", {"FAIL pre %3: faces=7"}, 12},
        {"a broken invariant", recorded(kR1, kR3, swap(kR4, "inv=\"holes=1\"", "inv=\"holes=0\"")),
         "op %4 CHAMFER (record line 9): INV-IN condition failed: holes=0",
         {"FAIL inv-in %4: holes=0", "FAIL inv-out %4: holes=0"}, 12},
        {"a pre with no input to hold it on",
         recorded(swap(kR1, "pre=none", "pre=\"faces=6\""), kR3, kR4),
         "op %1 BOX (record line 3): PRE condition failed: faces=6 (not evaluable: the op has "
         "no %ref input",
         {"FAIL pre %1: faces=6 (not evaluable"}, 13},
        {"a post naming no known quantity",
         recorded(kR1, kR3, swap(kR4, "post=\"faces>=10\"", "post=\"smoothness>=1\"")),
         "op %4 CHAMFER (record line 9): POST condition failed: smoothness>=1 (not evaluable: "
         "VERIFY: unknown quantity",
         {"FAIL post %4: smoothness>=1 (not evaluable"}, 12},
    };
    for (const auto& c : failing) {
        const CompileResult r = run(c.text);
        ok(!r.ok && r.error.rfind(c.errPrefix, 0) == 0,
           std::string("K4: ") + c.why + " fails the compile, naming op, line and phase: " +
               r.error);
        for (const char* l : c.lines)
            ok(has(r.verify, l), std::string("K4: ") + c.why + ": verify carries `" + l + "`");
        ok(r.nCompiled == 4 && sameBits(r.volume, plain.volume) && r.faceCount == plain.faceCount,
           std::string("K4: ") + c.why + ": the part was still built and measured (V bits, faces)");
        ok(r.verify.size() == c.conditions,
           std::string("K4: ") + c.why + ": every other condition was still evaluated");
    }

    // ── K5: the emitted text compiles exactly like the original ───────────────
    {
        FeatureTree t;
        std::string text;
        try {
            t = parse(full);
            text = emit(t);
        } catch (const std::exception& e) {
            ok(false, std::string("K5: parse + emit of the recorded tree: ") + e.what());
        }
        const CompileResult again = run(text);
        bool sameVerify = again.verify == rec.verify;
        ok(again.ok == rec.ok && sameBits(again.volume, rec.volume) &&
               again.faceCount == rec.faceCount && sameVerify,
           "K5: compile(emit(parse(x))) == compile(x): ok, volume bits, faces, every verify line");
    }

    std::printf("\n%d checks, %d failed\n", gChecks, gFails);
    return gFails == 0 ? 0 : 1;
}
