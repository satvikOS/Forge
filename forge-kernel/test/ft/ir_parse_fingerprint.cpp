// forge-kernel/test/ft/ir_parse_fingerprint.cpp
//
// T-132 -- PARSE PARITY. One line per corpus program: what forge::ft::parse()
// made of it, digested. run_ir_parse_parity.sh compiles THIS file twice -- once
// against the parser as it was before the op-record change, once against the
// parser as it is -- runs both over the same corpora and requires the outputs to
// be byte-identical. That is the measured form of "every existing program parses
// to exactly the tree it always did": not an argument from reading the diff, a
// comparison of every field of every tree (and every refusal, kind, line and
// message) on every program the repos hold.
//
// It therefore uses ONLY what the pre-change header already had: Op's
// id/code/name/args/poly/arcThrough/arcIsArc/srcLine, Token, resultId, Census'
// pre-existing buckets, ParseError. Nothing T-132 added may appear here, or the
// "before" build would not compile and the comparison would be no comparison.
//
// usage: ir_parse_fingerprint <corpus.json[l]>...   (stdout: the fingerprints;
//        stderr: a summary). Exit 2 if a corpus cannot be read.
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"
#include "ir_corpus.hpp"

using namespace forge::ft;

namespace {

void put(std::string& d, const std::string& s) {
    d += std::to_string(s.size());
    d += ':';
    d += s;
}
void put(std::string& d, long long v) { d += std::to_string(v) + ';'; }
void put(std::string& d, double v) {
    std::uint64_t b = 0;
    std::memcpy(&b, &v, sizeof b);
    char buf[24];
    std::snprintf(buf, sizeof buf, "%016" PRIx64 ";", b);
    d += buf;
}

// Every field the pre-change parser fills, in a fixed order. Bit patterns for
// doubles, lengths before strings: two different trees cannot share a dump.
std::string dumpTree(const FeatureTree& t) {
    std::string d = "OK|";
    put(d, static_cast<long long>(t.resultId));
    const Census& c = t.counts;
    for (std::size_t v : {c.sourceLines, c.blank, c.comments, c.templates, c.declared, c.parsed,
                          c.terminators})
        put(d, static_cast<long long>(v));
    put(d, static_cast<long long>(t.ops.size()));
    for (const Op& op : t.ops) {
        d += "|op";
        put(d, static_cast<long long>(op.id));
        put(d, static_cast<long long>(op.code));
        put(d, op.name);
        put(d, static_cast<long long>(op.srcLine));
        put(d, static_cast<long long>(op.args.size()));
        for (const Token& k : op.args) {
            put(d, static_cast<long long>(k.kind));
            put(d, k.num);
            put(d, static_cast<long long>(k.ref));
            put(d, k.kw);
            put(d, k.str);
            put(d, static_cast<long long>(k.dim));
            put(d, static_cast<long long>(k.pts.size()));
            for (const Point3& p : k.pts) { put(d, p.x); put(d, p.y); put(d, p.z); }
        }
        put(d, static_cast<long long>(op.poly.size()));
        for (const Point2& p : op.poly) { put(d, p.x); put(d, p.y); }
        put(d, static_cast<long long>(op.arcThrough.size()));
        for (const Point2& p : op.arcThrough) { put(d, p.x); put(d, p.y); }
        put(d, static_cast<long long>(op.arcIsArc.size()));
        for (char a : op.arcIsArc) put(d, static_cast<long long>(a));
    }
    return d;
}

const char* kindName(ParseFailure k) {
    switch (k) {
        case ParseFailure::Syntax: return "Syntax";
        case ParseFailure::OpaquePlaceholder: return "OpaquePlaceholder";
        case ParseFailure::Cardinality: return "Cardinality";
        case ParseFailure::Incomplete: return "Incomplete";
    }
    return "?";
}

}  // namespace

int main(int argc, char** argv) {
    std::vector<std::string> files(argv + 1, argv + argc);
    if (files.empty()) {
        std::fprintf(stderr, "usage: ir_parse_fingerprint <corpus.json[l]>...\n");
        return 2;
    }
    std::vector<ir_corpus::Program> progs;
    std::string err;
    if (!ir_corpus::readCorpus(files, progs, err)) {
        std::fprintf(stderr, "ir_parse_fingerprint: %s\n", err.c_str());
        return 2;
    }
    std::size_t nOk = 0, nSyntax = 0, nPlaceholder = 0, nCard = 0, nIncomplete = 0, nOther = 0;
    for (std::size_t i = 0; i < progs.size(); ++i) {
        std::string d, cls;
        try {
            const FeatureTree t = parse(progs[i].text);
            d = dumpTree(t);
            cls = "OK";
            ++nOk;
        } catch (const ParseError& e) {
            cls = kindName(e.kind);
            d = std::string("ERR|") + cls + "|";
            put(d, static_cast<long long>(e.line));
            put(d, e.offending);
            put(d, std::string(e.what()));
            d += dumpTree(e.checkpoint);
            switch (e.kind) {
                case ParseFailure::Syntax: ++nSyntax; break;
                case ParseFailure::OpaquePlaceholder: ++nPlaceholder; break;
                case ParseFailure::Cardinality: ++nCard; break;
                case ParseFailure::Incomplete: ++nIncomplete; break;
            }
        } catch (const std::exception& e) {
            cls = "Exception";
            d = std::string("EXC|") + e.what();
            ++nOther;
        }
        std::printf("%zu %016" PRIx64 " %016" PRIx64 " %s\n", i,
                    ir_corpus::fnv1a(progs[i].text), ir_corpus::fnv1a(d), cls.c_str());
    }
    std::fprintf(stderr,
                 "ir_parse_fingerprint: %zu programs: %zu parsed, %zu Syntax, %zu "
                 "OpaquePlaceholder, %zu Cardinality, %zu Incomplete, %zu other\n",
                 progs.size(), nOk, nSyntax, nPlaceholder, nCard, nIncomplete, nOther);
    return 0;
}
