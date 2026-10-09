// forge-kernel/test/ft/op_record_gate.cpp
//
// T-132 -- THE OP RECORD: provenance, dependencies, invariants, confidence.
//
// forge::ft::Op said WHAT to build and nothing about what the op RESTS ON. This
// gate proves the three things the ledger asks of the record extension:
//
//   A. EXISTING PROGRAMS ARE UNTOUCHED. Every program this repository already
//      ships (the differential corpus both execution paths read, and every
//      tracked *.ir) parses to a tree with no record and no contract, and
//      parse -> emit -> parse reproduces it field for field. The canonical ones
//      (no commentary) come back BYTE FOR BYTE.
//  A2. THE SAME OVER EXTERNAL CORPORA named in $OP_RECORD_CORPUS (JSON/JSONL),
//      e.g. every IR program archdisc-Models tracks: no record appears, every
//      tree survives emit -> parse field for field, emit is a fixed point.
//      (That the PRE-change parser read each of them identically is measured
//      separately, by run_ir_parse_parity.sh.)
//   B. A RECORD SURVIVES THE ROUND TRIP. Every field, the explicit-empty `none`,
//      the aliases, both quote characters, a synthetic id, ids at the int
//      limits, a quoted unit and the contract line.
//   C. AN OP MISSING A REQUIRED FIELD IS REFUSED, NOT BUILT. compile() returns
//      RECORD_REFUSED naming the op and the field, with handle 0, nCompiled 0
//      and the progress hook never called -- and it does so in a binary that
//      carries NO KERNEL (build_op_record_gate.sh leaves every forge::* kernel
//      symbol unresolved), so a refusal that had reached the kernel would not
//      have returned at all: it dies on the unresolved symbol, and a fatal-signal
//      handler names the case and exits 3. The same for every other refused
//      record.
//   D. A MALFORMED RECORD IS A PARSE ERROR, never a field quietly skipped.
//   E. THE CHECKS CAN FAIL: the tree comparator is shown to notice a change to
//      each record field, and a refused tree is shown to be accepted once the
//      one missing field is supplied. And emit() is shown to REFUSE a hand-built
//      record it could not write back identically, rather than writing it.
//
// The kernel-linked half -- conditions EVALUATED on built geometry, and an
// accepted record tree actually building -- is op_record_kernel_gate.cpp
// (build_op_record_kernel_gate.sh), because that needs the kernel this binary
// omits.
#include <unistd.h>

#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "forge/ft/FeatureTree.hpp"
#include "ir_corpus.hpp"

#ifndef FORGE_REPO_ROOT
#error "build with -DFORGE_REPO_ROOT=\"<repo>\" (build_op_record_gate.sh does)"
#endif

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

bool sameBits(double a, double b) { return std::memcmp(&a, &b, sizeof(double)) == 0; }

// Field-for-field equality of everything parse() keeps EXCEPT where it was on the
// page: srcLine, the record's line, and the census buckets that count layout
// (blank / comment / template / terminator / record lines). declared and parsed
// are compared: they count statements, not layout.
bool sameTree(const FeatureTree& a, const FeatureTree& b, std::string& why) {
    auto bad = [&](const std::string& w) { why = w; return false; };
    if (a.ops.size() != b.ops.size()) return bad("op count");
    if (a.resultId != b.resultId) return bad("resultId");
    if (a.required != b.required) return bad("required");
    if (a.counts.declared != b.counts.declared) return bad("declared");
    if (a.counts.parsed != b.counts.parsed) return bad("parsed");
    for (std::size_t i = 0; i < a.ops.size(); ++i) {
        const Op& x = a.ops[i];
        const Op& y = b.ops[i];
        const std::string at = "op[" + std::to_string(i) + "] %" + std::to_string(x.id) + " ";
        if (x.id != y.id || x.code != y.code || x.name != y.name) return bad(at + "id/code/name");
        if (x.args.size() != y.args.size()) return bad(at + "arg count");
        for (std::size_t k = 0; k < x.args.size(); ++k) {
            const Token& s = x.args[k];
            const Token& t = y.args[k];
            if (s.kind != t.kind || !sameBits(s.num, t.num) || s.ref != t.ref || s.str != t.str ||
                s.kw != t.kw || s.dim != t.dim || s.pts.size() != t.pts.size())
                return bad(at + "arg " + std::to_string(k));
            for (std::size_t m = 0; m < s.pts.size(); ++m)
                if (!sameBits(s.pts[m].x, t.pts[m].x) || !sameBits(s.pts[m].y, t.pts[m].y) ||
                    !sameBits(s.pts[m].z, t.pts[m].z))
                    return bad(at + "arg " + std::to_string(k) + " point " + std::to_string(m));
        }
        if (x.poly.size() != y.poly.size() || x.arcThrough.size() != y.arcThrough.size() ||
            x.arcIsArc != y.arcIsArc)
            return bad(at + "ring shape");
        for (std::size_t m = 0; m < x.poly.size(); ++m)
            if (!sameBits(x.poly[m].x, y.poly[m].x) || !sameBits(x.poly[m].y, y.poly[m].y))
                return bad(at + "ring vertex");
        for (std::size_t m = 0; m < x.arcThrough.size(); ++m)
            if (!sameBits(x.arcThrough[m].x, y.arcThrough[m].x) ||
                !sameBits(x.arcThrough[m].y, y.arcThrough[m].y))
                return bad(at + "arc through-point");
        const OpRecord& r = x.record;
        const OpRecord& q = y.record;
        if (r.stated != q.stated) return bad(at + "record.stated");
        if (r.units != q.units) return bad(at + "record.units");
        if (r.deps != q.deps) return bad(at + "record.deps");
        if (r.refs != q.refs) return bad(at + "record.refs");
        if (r.pre != q.pre) return bad(at + "record.pre");
        if (r.post != q.post) return bad(at + "record.post");
        if (r.inv != q.inv) return bad(at + "record.inv");
        if (!sameBits(r.confidence, q.confidence)) return bad(at + "record.confidence");
        if (r.provenance != q.provenance) return bad(at + "record.provenance");
        if (r.source != q.source) return bad(at + "record.source");
        if ((r.srcLine != 0) != (q.srcLine != 0)) return bad(at + "record presence");
    }
    return true;
}

bool tryParse(const std::string& text, FeatureTree& out, std::string& err,
              ParseFailure* kind = nullptr) {
    try {
        out = parse(text);
        return true;
    } catch (const ParseError& e) {
        err = e.what();
        if (kind) *kind = e.kind;
        return false;
    } catch (const std::exception& e) {
        err = e.what();
        return false;
    }
}

std::string readFile(const std::string& path, bool& opened) {
    std::ifstream in(path, std::ios::binary);
    opened = in.good();
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

// The differential corpus' `headlessIr` literals, read out of the header AS TEXT:
// one corpus, read by its two existing consumers and by this gate, never copied.
std::vector<std::string> differentialPrograms(const std::string& header) {
    std::vector<std::string> out;
    std::istringstream in(header);
    std::string line, cur;
    auto flush = [&]() { if (!cur.empty()) { out.push_back(cur); cur.clear(); } };
    while (std::getline(in, line)) {
        std::size_t a = line.find_first_not_of(" \t");
        const bool lit = a != std::string::npos && line.compare(a, 2, "\"%") == 0;
        const std::size_t nl = line.find("\\n\"");
        if (!lit || nl == std::string::npos) { flush(); continue; }
        cur += line.substr(a + 1, nl - a - 1) + "\n";
    }
    flush();
    return out;
}

int gHookCalls = 0;
void countingHook(int, const char*, int, void*) { ++gHookCalls; }

// ── what a refusal that reached the kernel looks like in THIS binary ────────
// No kernel is linked, so a compile() that got past the record refusal dies on
// an unresolved symbol. That death IS the detection; this makes it legible: the
// case being compiled is named and the gate exits 3 instead of a bare SIGSEGV.
char gCase[256] = {0};
extern "C" void onKernelReached(int sig) {
    (void)sig;
    if (gCase[0] == '\0') {
        const char m[] = "  FAIL  the gate died on a fatal signal outside any compile() call\n";
        (void)!write(1, m, sizeof m - 1);
        _exit(4);
    }
    const char a[] = "  FAIL  ";
    const char b[] = "compile() reached a kernel call (fatal signal) -- the record "
                     "refusal did not stop the build\n";
    (void)!write(1, a, sizeof a - 1);
    (void)!write(1, gCase, std::strlen(gCase));
    (void)!write(1, b, sizeof b - 1);
    _exit(3);
}

// compile() on a tree the gate expects to be REFUSED. If checkRecords() would
// accept the tree, compile() would go on to BUILD it -- here, a crash -- so that
// is reported as a FAIL and the compile is not attempted.
bool refusedCompile(const FeatureTree& t, const std::string& tag, CompileResult& cr) {
    if (checkRecords(t).empty()) {
        ok(false, tag + "checkRecords() ACCEPTS the tree, so compile() would build it");
        return false;
    }
    std::snprintf(gCase, sizeof gCase, "%s", tag.c_str());
    std::fflush(stdout);
    gHookCalls = 0;
    setCompileProgressHook(&countingHook, nullptr);
    cr = compile(t);
    setCompileProgressHook(nullptr, nullptr);
    gCase[0] = '\0';
    return true;
}

// The full-record program B and C are built from. Every op states every field.
const char* const kRecorded =
    "@REQUIRE units deps refs pre post inv conf prov\n"
    "%1 = BOX(40, 30, 20)\n"
    "@%1 units=mm deps=none refs=\"%1:block\" pre=none post=\"faces=6\" inv=none conf=1 prov=USER src=\"user: a 40 x 30 x 20 block\"\n"
    "%2 = CYL(6, 40)\n"
    "@%2 units=mm deps=none refs='%2:\"pin\" bore tool' pre=none post=\"faces=3\" inv=none conf=0.85 prov=SOURCE src='dwg A1, dim 7'\n"
    "%3 = CUT(%1, %2)\n"
    "@%3 units=mm deps=%1,%2 refs=\"%1:block\" refs=\"%3:bore\" pre=\"faces=6\" post=\"holes=1\" inv=\"bbox.x=40\" conf=0.9 prov=DERIVED\n"
    "%4 = CHAMFER(%3, 1, ALL)\n"
    "@%4 units=mm,1 deps=%3 refs=none pre=\"holes=1\" post=\"faces>=10\" inv=\"holes=1\" inv=\"bbox.y=30\" conf=0.6 prov=PROPOSED src=\"planner: break the edges\"\n"
    "RESULT(%4)\n";

}  // namespace

int main() {
    std::printf("=== T-132 op records: provenance, dependencies, invariants, confidence ===\n");
    for (int sig : {SIGSEGV, SIGBUS, SIGILL, SIGABRT}) std::signal(sig, onKernelReached);
    const std::string root = FORGE_REPO_ROOT;

    // ── A. existing programs are untouched ─────────────────────────────────────
    {
        std::vector<std::pair<std::string, std::string>> progs;
        bool opened = false;
        const std::string hdr = readFile(root + "/ui/test/differential_corpus.hpp", opened);
        ok(opened, "A: read ui/test/differential_corpus.hpp");
        for (const std::string& p : differentialPrograms(hdr))
            progs.emplace_back("differential_corpus.hpp", p);
        const std::size_t nDiff = progs.size();
        ok(nDiff >= 9, "A: the differential corpus yields >= 9 programs (got " +
                           std::to_string(nDiff) + ")");
        // every tracked *.ir under forge-kernel/test (listed by the build script)
        const char* irList = std::getenv("OP_RECORD_IR_FILES");
        std::size_t nIr = 0;
        if (irList) {
            std::istringstream ls(irList);
            std::string f;
            while (ls >> f) {
                bool o = false;
                const std::string t = readFile(root + "/" + f, o);
                ok(o, "A: read " + f);
                if (o) { progs.emplace_back(f, t); ++nIr; }
            }
        }
        ok(nIr >= 1, "A: at least one tracked *.ir program was read (got " +
                         std::to_string(nIr) + ")");

        std::size_t byteExact = 0, canonical = 0, addedFinalNewline = 0;
        for (const auto& kv : progs) {
            const std::string& src = kv.second;
            FeatureTree t1, t2;
            std::string err;
            if (!tryParse(src, t1, err)) { ok(false, "A: " + kv.first + " parses: " + err); continue; }
            bool anyRecord = false;
            for (const Op& op : t1.ops) anyRecord = anyRecord || op.record.present();
            ok(!anyRecord && t1.required == 0 && t1.counts.records == 0,
               "A: " + kv.first + " carries no record and no contract");
            const std::string e1 = emit(t1);
            if (!tryParse(e1, t2, err)) { ok(false, "A: emitted text re-parses: " + err); continue; }
            std::string why;
            ok(sameTree(t1, t2, why), "A: " + kv.first + " round-trips field for field (" + why + ")");
            ok(emit(t2) == e1, "A: " + kv.first + " emit is a fixed point");
            const bool isCanonical = t1.counts.comments == 0 && t1.counts.blank == 0 &&
                                     t1.counts.templates == 0;
            if (isCanonical) {
                ++canonical;
                // emit() ends every statement, the last one included, with '\n'.
                // A source file that stops without a final newline is the one
                // layout byte emit() supplies; it is counted, not hidden.
                if (e1 == src) ++byteExact;
                else if (e1 == src + "\n") { ++byteExact; ++addedFinalNewline; }
                else ok(false, "A: canonical " + kv.first + " comes back byte for byte:\n--- src\n" +
                                   src + "--- emit\n" + e1);
            }
        }
        std::printf("  A: %zu programs (%zu differential, %zu *.ir); %zu canonical, %zu byte-exact "
                    "(%zu of them differ only by the final newline emit() adds)\n",
                    progs.size(), nDiff, nIr, canonical, byteExact, addedFinalNewline);
        ok(canonical >= nDiff, "A: every differential program is canonical");
        ok(byteExact == canonical, "A: every canonical program is byte-exact");
    }

    // ── A2. the same over external corpora (OP_RECORD_CORPUS) ─────────────────
    // Every IR program in the named JSON / JSONL files -- in practice an export of
    // every program archdisc-Models tracks: training data, model emissions, held-out
    // sets. Most were written by a model, not by forge::ui, so many are NOT in the
    // app's spelling (spacing, `1.0` for `1`, lower-case keywords, commentary) and
    // emit() normalises them; byte-exactness is therefore REPORTED here, and what
    // is REQUIRED of every program that parses is what "byte-stable" means for
    // text a model wrote: no record and no contract appear from nowhere, the tree
    // survives emit -> parse field for field, and emit is a fixed point -- the
    // first emission is the last spelling the program ever takes. Whether the
    // pre-change parser read every one of them identically is
    // run_ir_parse_parity.sh's question, not this one's.
    if (const char* corpusEnv = std::getenv("OP_RECORD_CORPUS"); corpusEnv && *corpusEnv) {
        std::vector<std::string> files;
        std::string cur;
        for (const char* p = corpusEnv;; ++p) {
            if (*p == ':' || *p == '\0') {
                if (!cur.empty()) files.push_back(cur);
                cur.clear();
                if (*p == '\0') break;
            } else {
                cur += *p;
            }
        }
        std::vector<ir_corpus::Program> progs;
        std::string err;
        ok(ir_corpus::readCorpus(files, progs, err), "A2: the corpus reads: " + err);
        std::size_t parsed = 0, refusedByParse = 0, fieldExact = 0, fixedPoint = 0, byteExact = 0,
                    withLayout = 0, recordFree = 0;
        int shown = 0;
        for (const ir_corpus::Program& pr : progs) {
            FeatureTree t1, t2;
            std::string perr;
            if (!tryParse(pr.text, t1, perr)) { ++refusedByParse; continue; }
            ++parsed;
            bool anyRecord = false;
            for (const Op& op : t1.ops) anyRecord = anyRecord || op.record.present();
            if (!anyRecord && t1.required == 0 && t1.counts.records == 0) ++recordFree;
            std::string e1;
            try {
                e1 = emit(t1);
            } catch (const std::exception& ex) {
                if (shown++ < 5) ok(false, "A2: " + pr.origin + " emit threw: " + ex.what());
                continue;
            }
            std::string why;
            const bool reparsed = tryParse(e1, t2, perr);
            if (reparsed && sameTree(t1, t2, why)) ++fieldExact;
            else if (shown++ < 5)
                ok(false, "A2: " + pr.origin + " round-trips field for field (" +
                              (reparsed ? why : "re-parse failed: " + perr) + ")\n--- src\n" +
                              pr.text + "\n--- emit\n" + e1);
            if (reparsed && emit(t2) == e1) ++fixedPoint;
            if (e1 == pr.text || e1 == pr.text + "\n") ++byteExact;
            if (t1.counts.comments != 0 || t1.counts.blank != 0 || t1.counts.templates != 0)
                ++withLayout;
        }
        std::printf("  A2: %zu corpus programs from %zu file(s): %zu parse (%zu refused by the "
                    "parser, untouched); of those %zu record-free, %zu field-exact, %zu emit "
                    "fixed points, %zu byte-exact as stored (%zu carry commentary/blank lines "
                    "emit() does not keep)\n",
                    progs.size(), files.size(), parsed, refusedByParse, recordFree, fieldExact,
                    fixedPoint, byteExact, withLayout);
        ok(!progs.empty(), "A2: the corpus holds at least one program");
        ok(recordFree == parsed, "A2: no existing program grows a record or a contract (" +
                                     std::to_string(parsed - recordFree) + " did)");
        ok(fieldExact == parsed, "A2: every parsed program round-trips field for field (" +
                                     std::to_string(parsed - fieldExact) + " did not)");
        ok(fixedPoint == parsed, "A2: emit is a fixed point on every parsed program (" +
                                     std::to_string(parsed - fixedPoint) + " were not)");
    }

    // ── B. a record survives the round trip ───────────────────────────────────
    FeatureTree rec;
    {
        std::string err;
        ok(tryParse(kRecorded, rec, err), "B: the recorded program parses: " + err);
        ok(rec.required == kRecAll, "B: @REQUIRE names all eight fields");
        ok(rec.counts.records == 5 && rec.counts.declared == 4 && rec.counts.parsed == 4,
           "B: census counts 5 record lines, 4 declared, 4 parsed");
        if (rec.ops.size() == 4) {
            const OpRecord& r1 = rec.ops[0].record;
            ok(r1.stated == kRecAll && r1.units == std::vector<std::string>{"mm"} &&
                   r1.deps.empty() && r1.refs == std::vector<std::string>{"%1:block"} &&
                   r1.pre.empty() && r1.post == std::vector<std::string>{"faces=6"} &&
                   r1.inv.empty() && r1.confidence == 1.0 && r1.provenance == Provenance::User &&
                   r1.source == "user: a 40 x 30 x 20 block" && r1.srcLine == 3,
               "B: %1's record reads back every field, `none` as a stated empty list");
            const OpRecord& r2 = rec.ops[1].record;
            ok(r2.refs == std::vector<std::string>{"%2:\"pin\" bore tool"} &&
                   r2.source == "dwg A1, dim 7" && r2.provenance == Provenance::Source &&
                   r2.confidence == 0.85,
               "B: single-quoted values keep spaces, commas and a '\"'");
            const OpRecord& r3 = rec.ops[2].record;
            ok(r3.deps == std::vector<int>{1, 2} &&
                   r3.refs == std::vector<std::string>{"%1:block", "%3:bore"} &&
                   r3.pre == std::vector<std::string>{"faces=6"} &&
                   r3.inv == std::vector<std::string>{"bbox.x=40"} &&
                   r3.provenance == Provenance::Derived && r3.source.empty(),
               "B: %3 lists two deps and repeats refs");
            const OpRecord& r4 = rec.ops[3].record;
            ok(r4.units == std::vector<std::string>{"mm", "1"} && r4.refs.empty() &&
                   r4.has(kRecRefs) &&
                   r4.inv == std::vector<std::string>{"holes=1", "bbox.y=30"} &&
                   r4.provenance == Provenance::Proposed,
               "B: %4 unit list, explicit-empty refs, two invariants");
        }
        const std::string e1 = emit(rec);
        FeatureTree back;
        ok(tryParse(e1, back, err), "B: the emitted record program re-parses: " + err);
        std::string why;
        ok(sameTree(rec, back, why), "B: every record field survives emit -> parse (" + why + ")");
        ok(emit(back) == e1, "B: emit is a fixed point on a recorded tree");
        ok(e1.rfind("@REQUIRE units deps refs pre post inv conf prov\n%1 = BOX(40, 30, 20)\n"
                    "@%1 units=mm deps=none refs=\"%1:block\" pre=none post=\"faces=6\" inv=none "
                    "conf=1 prov=USER src=\"user: a 40 x 30 x 20 block\"\n", 0) == 0,
           "B: canonical record text is exact:\n" + e1);
        ok(e1.find("refs='%2:\"pin\" bore tool'") != std::string::npos,
           "B: a value holding '\"' is emitted single-quoted");

        // aliases and case collapse to the canonical record
        FeatureTree al;
        ok(tryParse("%1 = BOX(1, 2, 3)\n@1 UNITS=mm Dependencies=none Ref=\"%1:x\" "
                    "precondition=none Postcondition=\"faces=6\" invariants=none "
                    "Confidence=0.5 Provenance=engineering_derived SOURCE=\"calc\"\n",
                    al, err),
           "B: aliases parse: " + err);
        if (!al.ops.empty())
            ok(al.ops[0].record.stated == kRecAll &&
                   al.ops[0].record.provenance == Provenance::Derived &&
                   emit(al) == "%1 = BOX(1, 2, 3)\n@%1 units=mm deps=none refs=\"%1:x\" pre=none "
                               "post=\"faces=6\" inv=none conf=0.5 prov=DERIVED src=\"calc\"\n",
               "B: aliases emit as the canonical keys:\n" + emit(al));

        // a record on a parser-synthesised VERIFY id
        FeatureTree sv;
        ok(tryParse("%1 = BOX(1, 2, 3)\nVERIFY \"faces=6\"\n@%-1 deps=%1 prov=USER\n", sv, err),
           "B: a bare VERIFY's synthetic id can carry a record: " + err);
        if (sv.ops.size() == 2) {
            FeatureTree sv2;
            ok(tryParse(emit(sv), sv2, err) && sameTree(sv, sv2, err),
               "B: the synthetic-id record round-trips (" + err + ")");
        }

        // numbers that %.10g would round: exact bits survive
        FeatureTree nb;
        ok(tryParse("%1 = BOX(0.1, 139.20000000001, 1e-300)\n%2 = TRANSLATE(%1, -0, 1e21, "
                    "3.141592653589793)\n@%2 conf=0.123456789012345\n", nb, err),
           "B: number program parses: " + err);
        FeatureTree nb2;
        ok(tryParse(emit(nb), nb2, err) && sameTree(nb, nb2, err),
           "B: 17-digit, -0 and extreme numbers round-trip bit-exactly (" + err + ")\n" + emit(nb));

        // a QUOTED unit is one unit, verbatim; a BARE unit value is a comma list
        FeatureTree qu;
        ok(tryParse("%1 = BOX(1, 2, 3)\n@%1 units=\" N, m\" units=mm,deg\n", qu, err),
           "B: quoted and bare units parse: " + err);
        if (qu.ops.size() == 1) {
            ok(qu.ops[0].record.units == std::vector<std::string>{" N, m", "mm", "deg"},
               "B: a quoted unit is kept whole (comma, leading space); a bare one is split");
            FeatureTree qu2;
            ok(tryParse(emit(qu), qu2, err) && sameTree(qu, qu2, err),
               "B: the quoted unit round-trips (" + err + ")\n" + emit(qu));
        }
        // the largest and the most negative ids a record can name
        FeatureTree big;
        ok(tryParse("%2147483647 = BOX(1, 2, 3)\n@%2147483647 deps=none\n%-2147483647 = "
                    "VERIFY(%2147483647, \"faces=6\")\n@%-2147483647 deps=%2147483647\n",
                    big, err),
           "B: records on ids at the int limits parse: " + err);
        if (big.ops.size() == 2) {
            ok(big.ops[1].record.deps == std::vector<int>{2147483647},
               "B: deps=%2147483647 reads as INT_MAX");
            FeatureTree big2;
            ok(tryParse(emit(big), big2, err) && sameTree(big, big2, err),
               "B: int-limit ids round-trip (" + err + ")");
        }
    }

    // ── C. an op missing a required field is REFUSED, not built ───────────────
    {
        ok(checkRecords(rec).empty(), "C: the full-record tree has no refusal (positive control)");
        for (const auto& fn : {std::make_pair(kRecUnits, "units"), std::make_pair(kRecDeps, "deps"),
                               std::make_pair(kRecRefs, "refs"), std::make_pair(kRecPre, "pre"),
                               std::make_pair(kRecPost, "post"), std::make_pair(kRecInv, "inv"),
                               std::make_pair(kRecConf, "conf"), std::make_pair(kRecProv, "prov")}) {
            FeatureTree t = rec;
            // drop the field from %3's record, the way an emitter that forgot it would
            OpRecord& r = t.ops[2].record;
            r.stated = static_cast<std::uint16_t>(r.stated & ~fn.first);
            const std::string tag = std::string("C: missing `") + fn.second + "` -> ";
            CompileResult cr;
            if (!refusedCompile(t, tag, cr)) continue;
            ok(!cr.ok, tag + "not ok");
            ok(cr.error.rfind("RECORD_REFUSED: op %3 CUT (line 6): its record does not state " +
                                  std::string(fn.second), 0) == 0,
               tag + "RECORD_REFUSED names %3 and the field: " + cr.error);
            ok(cr.failedOpId == 3, tag + "failedOpId == 3");
            ok(cr.handle == 0 && cr.nCompiled == 0, tag + "nothing built (handle 0, nCompiled 0)");
            ok(gHookCalls == 0, tag + "no op was ever announced to the build loop");
            ok(cr.nParsed == 4, tag + "the census is still reported (nParsed 4)");
        }
        // the same, written in TEXT: an op with no record at all under @REQUIRE
        {
            FeatureTree t;
            std::string err;
            ok(tryParse("@REQUIRE ALL\n%1 = BOX(4, 4, 4)\n", t, err), "C: unrecorded op parses");
            CompileResult cr;
            if (refusedCompile(t, "C: an op with no record under @REQUIRE ALL -> ", cr))
                ok(!cr.ok && cr.error.find("has no `@%1` record") != std::string::npos &&
                       cr.handle == 0 && cr.nCompiled == 0 && gHookCalls == 0,
                   "C: an op with no record under @REQUIRE ALL is refused unbuilt: " + cr.error);
            const char* const ctText = "@REQUIRE conf\n%1 = BOX(4, 4, 4)\n";
            FeatureTree tc;
            if (tryParse(ctText, tc, err) && !checkRecords(tc).empty()) {
                std::snprintf(gCase, sizeof gCase, "%s", "C: compileText -> ");
                std::fflush(stdout);
                const CompileResult ct = compileText(ctText, "");
                gCase[0] = '\0';
                ok(!ct.ok && ct.error.rfind("RECORD_REFUSED: op %1 BOX (line 2): its record does "
                                            "not state conf", 0) == 0 && ct.nCompiled == 0,
                   "C: compileText refuses the same: " + ct.error);
            } else {
                ok(false, "C: compileText case: checkRecords() ACCEPTS it (" + err + ")");
            }
        }
        // a CALLER-imposed contract on a program whose text asked for none
        {
            FeatureTree t;
            std::string err;
            ok(tryParse("%1 = BOX(4, 4, 4)\n@%1 units=mm deps=none prov=USER\n", t, err),
               "C: partly recorded program parses");
            ok(checkRecords(t).empty(), "C: with no contract nothing is required");
            t.required = kRecAll;
            const auto rf = checkRecords(t);
            ok(rf.size() == 1 && rf[0].opId == 1 &&
                   rf[0].reason.find("does not state refs pre post inv conf") != std::string::npos,
               "C: a caller-imposed contract names exactly the five unstated fields");
        }
        // every other refused record, each one alone
        const struct { const char* why; const char* text; const char* needle; int op; } bad[] = {
            {"inches", "%1 = BOX(1, 2, 3)\n@%1 units=in\n", "unit `in` is not an IR unit", 1},
            {"radians", "%1 = BOX(1, 2, 3)\n%2 = ROTATE(%1, 1.57, 0, 0, 1)\n@%2 units=mm,rad deps=%1\n",
             "unit `rad` is not an IR unit", 2},
            {"forward dep", "%1 = BOX(1, 2, 3)\n@%1 deps=%2\n%2 = BOX(1, 1, 1)\n",
             "dependency %2 is not an op defined before this one", 1},
            {"self dep", "%1 = BOX(1, 2, 3)\n@%1 deps=%1\n",
             "dependency %1 is not an op defined before this one", 1},
            {"undeclared input",
             "%1 = BOX(4, 4, 4)\n%2 = CYL(1, 9)\n%3 = CUT(%1, %2)\n@%3 deps=%1\n",
             "consumes %2 but its record's deps do not list it", 3},
            {"ref to a later op", "%1 = BOX(1, 2, 3)\n@%1 refs=\"%2:face\"\n%2 = BOX(1, 1, 1)\n",
             "names %2, which is neither this op nor one defined before it", 1},
            {"confidence > 1", "%1 = BOX(1, 2, 3)\n@%1 conf=1.5\n", "confidence must be in [0, 1]", 1},
            {"confidence < 0", "%1 = BOX(1, 2, 3)\n@%1 conf=-0.1\n", "confidence must be in [0, 1]", 1},
            {"confidence nan", "%1 = BOX(1, 2, 3)\n@%1 conf=nan\n", "confidence must be in [0, 1]", 1},
            {"unresolved", "%1 = BOX(1, 2, 3)\n%2 = FILLET(%1, 9, ALL)\n@%2 prov=UNRESOLVED\n",
             "provenance is UNRESOLVED", 2},
            {"synthetic id under contract", "@REQUIRE prov\n%1 = BOX(1, 2, 3)\n@%1 prov=USER\nVERIFY \"faces=6\"\n",
             "is the id parse() gave a bare VERIFY", -1},
        };
        for (const auto& b : bad) {
            FeatureTree t;
            std::string err;
            if (!tryParse(b.text, t, err)) { ok(false, std::string("C: ") + b.why + " parses: " + err); continue; }
            CompileResult cr;
            if (!refusedCompile(t, std::string("C: ") + b.why + " -> ", cr)) continue;
            ok(!cr.ok && cr.error.rfind("RECORD_REFUSED: ", 0) == 0 &&
                   cr.error.find(b.needle) != std::string::npos && cr.failedOpId == b.op &&
                   cr.handle == 0 && cr.nCompiled == 0 && gHookCalls == 0,
               std::string("C: ") + b.why + " is refused unbuilt: " + cr.error);
        }
    }

    // ── D. a malformed record is a parse error, never a skipped field ─────────
    {
        const struct { const char* why; const char* text; ParseFailure kind; const char* needle; } bad[] = {
            {"unknown key", "%1 = BOX(1, 2, 3)\n@%1 tolerance=0.1\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "unknown record key `tolerance`"},
            {"unknown key on the LAST line is still Syntax, not Incomplete",
             "%1 = BOX(1, 2, 3)\n@%1 tolerance=0.1\n", ParseFailure::Syntax, "unknown record key"},
            {"unknown provenance", "%1 = BOX(1, 2, 3)\n@%1 prov=GUESSED\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "prov takes USER"},
            {"conf not a number", "%1 = BOX(1, 2, 3)\n@%1 conf=high\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "conf takes a number"},
            {"deps not refs", "%1 = BOX(1, 2, 3)\n%2 = BOX(1, 1, 1)\n@%2 deps=1\n%3 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "deps takes %<id> refs"},
            {"record before its op", "@%1 prov=USER\n%1 = BOX(1, 2, 3)\n", ParseFailure::Syntax,
             "not an op defined above it"},
            {"second record", "%1 = BOX(1, 2, 3)\n@%1 prov=USER\n@%1 conf=1\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "a second record for %1"},
            {"scalar twice", "%1 = BOX(1, 2, 3)\n@%1 conf=1 conf=0.5\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "states `conf` twice"},
            {"none and values", "%1 = BOX(1, 2, 3)\n@%1 refs=none refs=\"%1:x\"\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "both none and values"},
            {"empty record", "%1 = BOX(1, 2, 3)\n@%1\n%2 = BOX(1, 1, 1)\n", ParseFailure::Syntax,
             "states nothing"},
            {"contract after an op", "%1 = BOX(1, 2, 3)\n@REQUIRE prov\n", ParseFailure::Syntax,
             "must come before the first op"},
            {"unknown contract field", "@REQUIRE prov colour\n%1 = BOX(1, 2, 3)\n",
             ParseFailure::Syntax, "unknown field `colour`"},
            // An '@' line that is not record-SHAPED is not record syntax at all: it
            // keeps the s0.5 refusal (and failure class) it always had.
            {"a non-record '@' directive stays an s0.5 placeholder",
             "@ENSURE prov\n%1 = BOX(1, 2, 3)\n", ParseFailure::OpaquePlaceholder,
             "rejected executable statement `@ENSURE prov`"},
            {"'@' prose mid-program stays an s0.5 placeholder",
             "%1 = BOX(1, 2, 3)\n@boss apply fillets\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::OpaquePlaceholder, "rejected executable statement `@boss apply fillets`"},
            {"a bare '@' stays an s0.5 placeholder", "%1 = BOX(1, 2, 3)\n@\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::OpaquePlaceholder, "rejected executable statement `@`"},
            {"`@REQUIREMENTS` is not the contract", "@REQUIREMENTS prov\n%1 = BOX(1, 2, 3)\n",
             ParseFailure::OpaquePlaceholder, "rejected executable statement"},
            {"`@%x` is record-shaped and malformed", "%1 = BOX(1, 2, 3)\n@%x prov=USER\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "an op record is written `@%<id>"},
            {"no '=' mid-program", "%1 = BOX(1, 2, 3)\n@%1 prov\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "is not `key=value`"},
            {"unterminated quote mid-program",
             "%1 = BOX(1, 2, 3)\n@%1 src=\"drawing A1\n%2 = BOX(1, 1, 1)\n", ParseFailure::Syntax,
             "unterminated quoted value"},
            {"a truncated final record is Incomplete",
             "%1 = BOX(1, 2, 3)\n@%1 units=mm src=\"drawi", ParseFailure::Incomplete,
             "PAUSED_INCOMPLETE"},
            // values the grammar could read once and not write back the same
            {"a value holding both quote characters",
             "%1 = BOX(1, 2, 3)\n@%1 src=\"it's 5\"x long\"\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "holds both quote characters"},
            {"an empty src", "%1 = BOX(1, 2, 3)\n@%1 src=\"\"\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "has an empty value"},
            {"deps %1.0", "%1 = BOX(1, 2, 3)\n%2 = BOX(1, 1, 1)\n@%2 deps=%1.0\n%3 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "deps takes %<id> refs, got `%1.0`"},
            {"deps %1e0", "%1 = BOX(1, 2, 3)\n%2 = BOX(1, 1, 1)\n@%2 deps=%1e0\n%3 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "deps takes %<id> refs, got `%1e0`"},
            {"deps past INT_MAX",
             "%1 = BOX(1, 2, 3)\n%2 = BOX(1, 1, 1)\n@%2 deps=%2147483648\n%3 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "deps takes %<id> refs"},
            {"a record id past INT_MAX",
             "%1 = BOX(1, 2, 3)\n@%99999999999 prov=USER\n%2 = BOX(1, 1, 1)\n",
             ParseFailure::Syntax, "an op record is written `@%<id>"},
        };
        for (const auto& b : bad) {
            FeatureTree t;
            std::string err;
            ParseFailure k = ParseFailure::Syntax;
            const bool parsed = tryParse(b.text, t, err, &k);
            ok(!parsed && k == b.kind && err.find(b.needle) != std::string::npos,
               std::string("D: ") + b.why + ": " + (parsed ? "PARSED" : err));
        }
        // Incomplete keeps the checkpoint, with the record-less op in it
        try {
            (void)parse("%1 = BOX(1, 2, 3)\n@%1 units=mm src=\"drawi");
            ok(false, "D: truncated record throws");
        } catch (const ParseError& e) {
            ok(e.checkpoint.ops.size() == 1, "D: the Incomplete checkpoint holds the op already read");
        }
    }

    // ── E. the checks can fail ─────────────────────────────────────────────────
    {
        // the comparator notices a change to each record field
        int caught = 0;
        const int nMut = 11;
        for (int m = 0; m < nMut; ++m) {
            FeatureTree t = rec;
            OpRecord& r = t.ops[2].record;
            switch (m) {
                case 0: r.units.push_back("deg"); break;
                case 1: r.deps.pop_back(); break;
                case 2: r.refs[1] = "%3:boss"; break;
                case 3: r.pre.clear(); break;
                case 4: r.post[0] = "holes=2"; break;
                case 5: r.inv.push_back("holes=1"); break;
                case 6: r.confidence = std::nextafter(0.9, 1.0); break;
                case 7: r.provenance = Provenance::Proposed; break;
                case 8: r.source = "x"; break;
                case 9: r.stated = static_cast<std::uint16_t>(r.stated & ~kRecInv); break;
                case 10: t.required = kRecProv; break;
            }
            std::string why;
            if (!sameTree(rec, t, why)) ++caught;
        }
        ok(caught == nMut, "E: the tree comparator catches " + std::to_string(caught) + "/" +
                               std::to_string(nMut) + " single-field record mutations");
        // and a mutation that drops a record in the emitted TEXT is caught too
        std::string e = emit(rec);
        const std::size_t at = e.find("@%3 ");
        std::string err;
        if (at == std::string::npos) {
            ok(false, "E: the emitted text holds %3's record line at all:\n" + e);
        } else {
            e.erase(at, e.find('\n', at) - at + 1);
            FeatureTree dropped;
            ok(tryParse(e, dropped, err) && !sameTree(rec, dropped, err),
               "E: a record line dropped from the text is a round-trip difference (" + err + ")");
        }
        // the refused tree is accepted once the one missing field is supplied
        FeatureTree t = rec;
        t.ops[2].record.stated = static_cast<std::uint16_t>(t.ops[2].record.stated & ~kRecConf);
        ok(!checkRecords(t).empty(), "E: dropping conf from %3 is refused ...");
        t.ops[2].record.stated |= kRecConf;
        ok(checkRecords(t).empty(), "E: ... and restoring it is accepted -- the arms differ");

        // emit() REFUSES a hand-built record it could not write so that it reads
        // back the same, instead of writing text that parses into something else
        const struct { const char* why; void (*mutate)(FeatureTree&); } unspellable[] = {
            {"a src holding both quote characters",
             [](FeatureTree& f) { f.ops[0].record.source = "it's 5\" long"; }},
            {"a src holding a line break",
             [](FeatureTree& f) { f.ops[0].record.source = "two\nlines"; }},
            {"an empty ref", [](FeatureTree& f) { f.ops[2].record.refs.push_back(""); }},
            {"refs content its stated set does not mark",
             [](FeatureTree& f) {
                 f.ops[2].record.stated = static_cast<std::uint16_t>(f.ops[2].record.stated & ~kRecRefs);
             }},
            {"a stated prov naming no provenance",
             [](FeatureTree& f) { f.ops[0].record.provenance = Provenance::Unstated; }},
            {"a contract bit outside kRecAll",
             [](FeatureTree& f) { f.required = static_cast<std::uint16_t>(f.required | 0x100u); }},
            {"a conf value without the conf bit",
             [](FeatureTree& f) {
                 f.ops[1].record.stated = static_cast<std::uint16_t>(f.ops[1].record.stated & ~kRecConf);
             }},
        };
        bool controlEmits = true;
        try { (void)emit(rec); } catch (...) { controlEmits = false; }
        ok(controlEmits, "E: the unmutated recorded tree emits (positive control)");
        for (const auto& u : unspellable) {
            FeatureTree m = rec;
            u.mutate(m);
            bool threw = false;
            std::string what;
            try { (void)emit(m); } catch (const std::invalid_argument& ex) { threw = true; what = ex.what(); }
            ok(threw && what.rfind("emit: ", 0) == 0,
               std::string("E: emit refuses ") + u.why + (threw ? ": " + what : ": it wrote text"));
        }
    }

    std::printf("\n%d checks, %d failed\n", gChecks, gFails);
    return gFails == 0 ? 0 : 1;
}
