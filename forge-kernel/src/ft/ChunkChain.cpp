// ============================================================================
// forge::ft — chunked emission with a cryptographic hash/count chain (s0.11),
// and the CHUNK-CORRUPTION detector Appendix B requires.
//
// Pure std C++: no kernel symbol, no OCCT, no third-party dependency. That is
// deliberate — the chain has to be verifiable in any process that can read the
// stream, including one that cannot link the modelling kernel.
// ============================================================================

#include "forge/ft/ChunkChain.hpp"

#include <cstddef>
#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"
#include "forge/native/util/Sha256.hpp"

namespace forge {
namespace ft {
namespace {

// Length-prefixed field joining. Plain concatenation would let two different
// field splits hash identically ("ab"+"c" == "a"+"bc"), which is a real forgery
// path for a chain whose whole job is to be unforgeable.
void field(std::string& acc, const std::string& v) {
    acc += std::to_string(v.size());
    acc += ':';
    acc += v;
    acc += '|';
}
void field(std::string& acc, std::size_t v) { field(acc, std::to_string(v)); }

}  // namespace

// The single FIPS 180-4 implementation now lives in forge::native::util so the
// storage governor (s21.3) can hash its plan receipts without a second copy.
// This stays the forge::ft entry point, so the NIST vectors asserted in
// s0_acceptance_test.cpp go on testing the same code through this name.
std::string sha256Hex(const std::string& message) {
    return ::forge::native::util::sha256Hex(message);
}

const char* toString(ChainFault f) {
    switch (f) {
        case ChainFault::None:              return "None";
        case ChainFault::HeaderAltered:     return "HeaderAltered";
        case ChainFault::ChunkAltered:      return "ChunkAltered";
        case ChainFault::LinkBroken:        return "LinkBroken";
        case ChainFault::SequenceGap:       return "SequenceGap";
        case ChainFault::DuplicateSequence: return "DuplicateSequence";
        case ChainFault::OutOfOrder:        return "OutOfOrder";
        case ChainFault::CountDrift:        return "CountDrift";
        case ChainFault::RootMismatch:      return "RootMismatch";
        case ChainFault::NotComplete:       return "NotComplete";
    }
    return "Unknown";
}

std::string GraphHeader::hash() const {
    std::string acc = "forge.ft.header|";
    field(acc, schemaVersion);
    field(acc, projectId);
    field(acc, normalizedSpecHash);
    field(acc, modelPackageHash);
    field(acc, compilerVersion);
    field(acc, plannedChunkCount);
    field(acc, declaredLineCount);
    return sha256Hex(acc);
}

std::string FeatureChunk::computeHash() const {
    std::string acc = "forge.ft.chunk|";
    field(acc, sequenceNumber);
    field(acc, previousChunkHash);
    field(acc, lines.size());
    for (const std::string& l : lines) field(acc, l);
    field(acc, runningCount);
    field(acc, unresolvedForwardDeclarations.size());
    for (const std::string& u : unresolvedForwardDeclarations) field(acc, u);
    return sha256Hex(acc);
}

ChunkStream emitChunked(const std::string& irText, std::size_t linesPerChunk,
                        const GraphHeader& proto) {
    if (linesPerChunk == 0) throw std::runtime_error("emitChunked: linesPerChunk must be >= 1");

    std::vector<std::string> lines;
    {
        std::istringstream in(irText);
        std::string l;
        while (std::getline(in, l)) lines.push_back(l);
    }

    ChunkStream s;
    s.header = proto;
    s.header.declaredLineCount = lines.size();
    s.header.plannedChunkCount = (lines.size() + linesPerChunk - 1) / linesPerChunk;

    std::string prev = s.header.hash();
    std::size_t running = 0;
    std::size_t seq = 0;
    for (std::size_t i = 0; i < lines.size(); i += linesPerChunk) {
        FeatureChunk c;
        c.sequenceNumber = ++seq;
        c.previousChunkHash = prev;
        for (std::size_t j = i; j < lines.size() && j < i + linesPerChunk; ++j)
            c.lines.push_back(lines[j]);
        running += c.lines.size();
        c.runningCount = running;
        c.chunkHash = c.computeHash();
        prev = c.chunkHash;
        s.chunks.push_back(std::move(c));
    }

    s.footer.finalCount = running;
    s.footer.unresolvedReferences = 0;
    s.footer.requirementCoverage = 1.0;
    s.footer.completionStatus = "COMPLETE";
    {
        std::string acc = "forge.ft.footer|";
        field(acc, prev);                       // last chunk hash
        field(acc, s.footer.finalCount);
        field(acc, s.chunks.size());
        s.footer.graphRootHash = sha256Hex(acc);
    }
    s.footer.replayFingerprint = sha256Hex(reassemble(s));
    return s;
}

std::string reassemble(const ChunkStream& s) {
    std::string out;
    for (const FeatureChunk& c : s.chunks)
        for (const std::string& l : c.lines) { out += l; out += '\n'; }
    return out;
}

ChainVerdict verifyChain(const ChunkStream& s) {
    ChainVerdict v;
    auto fail = [&v](ChainFault f, std::size_t at, const std::string& detail) {
        v.accepted = false;
        v.fault = f;
        v.atChunk = at;
        v.detail = detail;
        return v;
    };

    if (s.chunks.empty())
        return fail(ChainFault::CountDrift, 0, "stream carries no chunks");

    if (s.footer.completionStatus != "COMPLETE")
        return fail(ChainFault::NotComplete, 0,
                    "completion_status=" + s.footer.completionStatus +
                        " — a stream that did not finish is never accepted");

    const std::string headerHash = s.header.hash();

    std::string prev = headerHash;
    std::size_t running = 0;
    for (std::size_t i = 0; i < s.chunks.size(); ++i) {
        const FeatureChunk& c = s.chunks[i];
        const std::size_t expectedSeq = i + 1;

        // ---- REORDER / REMOVE / DUPLICATE, from the sequence numbers alone ---
        // The three are distinguished exactly, because the repair differs: a
        // duplicate is dropped, a reorder is re-sorted, a removal must be
        // re-requested from the emitter. Deciding by ">" alone mislabels a swap
        // as a removal, so ask what the whole stream actually contains.
        if (c.sequenceNumber != expectedSeq) {
            std::size_t occurrences = 0, expectedFound = 0;
            for (const FeatureChunk& o : s.chunks) {
                if (o.sequenceNumber == c.sequenceNumber) ++occurrences;
                if (o.sequenceNumber == expectedSeq) ++expectedFound;
            }
            ChainFault  f    = ChainFault::SequenceGap;
            std::string what = "chunk " + std::to_string(expectedSeq) + " was removed";
            if (occurrences > 1) {
                f = ChainFault::DuplicateSequence;
                what = "chunk " + std::to_string(c.sequenceNumber) + " appears " +
                       std::to_string(occurrences) + " times";
            } else if (expectedFound > 0) {
                f = ChainFault::OutOfOrder;
                what = "chunk " + std::to_string(expectedSeq) + " is present but later";
            }
            return fail(f, i + 1,
                        "sequence_number=" + std::to_string(c.sequenceNumber) +
                            " at position " + std::to_string(expectedSeq) + " (" + what + ")");
        }

        // ---- ALTER: the stored digest must match the content ----------------
        const std::string recomputed = c.computeHash();
        if (recomputed != c.chunkHash)
            return fail(ChainFault::ChunkAltered, c.sequenceNumber,
                        "chunk_hash=" + c.chunkHash.substr(0, 16) +
                            "... but its content hashes to " + recomputed.substr(0, 16) +
                            "... — the chunk body was altered");

        // ---- LINK: the back-pointer must match the predecessor ---------------
        if (c.previousChunkHash != prev) {
            const ChainFault f =
                (i == 0) ? ChainFault::HeaderAltered : ChainFault::LinkBroken;
            return fail(f, c.sequenceNumber,
                        "previous_chunk_hash=" + c.previousChunkHash.substr(0, 16) +
                            "... expected " + prev.substr(0, 16) +
                            (i == 0 ? "... (header anchor)" : "... (predecessor digest)"));
        }

        // ---- COUNT: the running count must match the payload -----------------
        running += c.lines.size();
        if (c.runningCount != running)
            return fail(ChainFault::CountDrift, c.sequenceNumber,
                        "running_count=" + std::to_string(c.runningCount) + " but " +
                            std::to_string(running) + " lines have been carried");

        prev = c.chunkHash;
    }

    // ---- FOOTER: final counts, root hash, replay fingerprint ------------------
    if (s.footer.finalCount != running)
        return fail(ChainFault::CountDrift, 0,
                    "final_count=" + std::to_string(s.footer.finalCount) + " but " +
                        std::to_string(running) + " lines were carried");
    if (s.header.declaredLineCount != running)
        return fail(ChainFault::CountDrift, 0,
                    "header declared_count=" + std::to_string(s.header.declaredLineCount) +
                        " but " + std::to_string(running) + " lines were carried");
    if (s.footer.unresolvedReferences != 0)
        return fail(ChainFault::CountDrift, 0,
                    "unresolved_references=" + std::to_string(s.footer.unresolvedReferences) +
                        " — s0.4 requires zero");

    std::string acc = "forge.ft.footer|";
    field(acc, prev);
    field(acc, s.footer.finalCount);
    field(acc, s.chunks.size());
    const std::string root = sha256Hex(acc);
    if (root != s.footer.graphRootHash)
        return fail(ChainFault::RootMismatch, 0,
                    "graph_root_hash=" + s.footer.graphRootHash.substr(0, 16) +
                        "... recomputed " + root.substr(0, 16) + "...");
    const std::string replay = sha256Hex(reassemble(s));
    if (replay != s.footer.replayFingerprint)
        return fail(ChainFault::RootMismatch, 0,
                    "replay_fingerprint=" + s.footer.replayFingerprint.substr(0, 16) +
                        "... recomputed " + replay.substr(0, 16) + "...");

    v.accepted = true;
    v.fault = ChainFault::None;
    v.atChunk = 0;
    v.detail = "chain verified: " + std::to_string(s.chunks.size()) + " chunks, " +
               std::to_string(running) + " lines, root " + root.substr(0, 16) + "...";
    return v;
}

FeatureTree accept(const ChunkStream& s) {
    const ChainVerdict v = verifyChain(s);
    if (!v.accepted)
        throw std::runtime_error(std::string("chunk chain REJECTED before acceptance: ") +
                                 toString(v.fault) +
                                 (v.atChunk ? " at chunk " + std::to_string(v.atChunk) : "") +
                                 " — " + v.detail);
    return parse(reassemble(s));
}

}  // namespace ft
}  // namespace forge
